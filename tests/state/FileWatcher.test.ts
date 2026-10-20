import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';

/**
 * Unit-тесты FileWatcher. Наблюдение (treeWatcher) полностью мокаем — настоящие watch'ы не
 * запускаем. Реальная fs-папка нужна только чтобы pre-scan (fs.readdir) не
 * падал, а isDangerousRepoRoot честно возвращал false для tmp-папки.
 *
 * Принцип: НИКАКИХ `setTimeout`-ов на синхронизацию. Все ожидания
 * результата async-цепочек — через `vi.waitFor`, который polls условие
 * каждые ~10мс пока оно не станет true (или не упрётся в timeout).
 * Это убирает класс flaky-падений «на быстрой машине ок, на загруженной
 * 30мс не хватило».
 *
 * Единственное место, где `setTimeout` оправдан — внутренние debounce'ы
 * FileWatcher (GIT_DEBOUNCE_MS=120, WORKTREE_DEBOUNCE_MS=200): мы ждём
 * САМ TIMER, а не race. Эти ожидания тоже сворачиваем в `vi.waitFor`,
 * который сам раскрутит polling.
 */

interface FakeWatcher extends EventEmitter {
  close: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  __target: string;
  __options: unknown;
}

const watchCalls: Array<{ target: string; options: unknown }> = [];
const createdWatchers: FakeWatcher[] = [];

function makeFakeWatcher(target: string, options: unknown): FakeWatcher {
  const w = new EventEmitter() as FakeWatcher;
  w.close = vi.fn(() => Promise.resolve());
  w.removeAllListeners = vi.fn(() => w);
  w.__target = target;
  w.__options = options;
  createdWatchers.push(w);
  return w;
}

// Мокаем обёртку наблюдения (treeWatcher): у неё интерфейс как у chokidar.
vi.mock('../../src/core/state/treeWatcher', () => ({
  watchTree: (target: string, options: unknown) => {
    watchCalls.push({ target, options });
    return makeFakeWatcher(target, options);
  },
}));

vi.mock('../../src/core/utils/Logger', () => ({
  mainLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let tmpRepo: string;

/**
 * На macOS os.tmpdir() — это /var/folders/..., а /var для isDangerousRepoRoot
 * системный путь: FileWatcher честно не создаёт watcher'ы, и тесты падают.
 * Реальный путь — /private/var/folders/..., под запрет он не попадает.
 * На Windows и Linux realpath ничего не меняет.
 */
const safeTmpDir = realpathSync(tmpdir());

function makeFakeStateManager() {
  return {
    invalidateGraphCache: vi.fn(),
    refreshAll: vi.fn(() => Promise.resolve()),
    refreshStatusAndNotify: vi.fn(() => Promise.resolve()),
  };
}

/**
 * Ждём, пока chokidar.watch будет вызван хотя бы один раз с предикатом.
 * `predicate` возвращает true, когда нужный watcher уже создан.
 * Default timeout 1500ms — с большим запасом против любой нагрузки CI.
 */
function waitForWatcher(predicate: (calls: typeof watchCalls) => boolean): Promise<void> {
  return vi.waitFor(() => {
    if (!predicate(watchCalls)) throw new Error('predicate not yet satisfied');
  }, { timeout: 1500, interval: 10 });
}

beforeEach(() => {
  tmpRepo = mkdtempSync(join(safeTmpDir, 'gitbor-fw-'));
  // создаём .git, чтобы директория выглядела как репо
  mkdirSync(join(tmpRepo, '.git'));
  watchCalls.length = 0;
  createdWatchers.length = 0;
});

afterEach(() => {
  try {
    rmSync(tmpRepo, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('FileWatcher', () => {
  describe('addRepo / ensureWatcher', () => {
    it('создаёт пару watcher\'ов (git + worktree) на не-опасном пути', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      await waitForWatcher(calls =>
        calls.some(c => c.target.endsWith('.git')) && calls.some(c => c.target === tmpRepo),
      );
      const gitWatch = watchCalls.find(c => c.target.endsWith('.git'));
      const treeWatch = watchCalls.find(c => c.target === tmpRepo);
      expect(gitWatch).toBeDefined();
      expect(treeWatch).toBeDefined();
      fw.dispose();
    });

    it('git-watcher без ограничения depth, служебку отсекает ignored', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      await waitForWatcher(calls => calls.some(c => c.target.endsWith('.git')));
      const gitCall = watchCalls.find(c => c.target.endsWith('.git'));
      const opts = gitCall!.options as Record<string, unknown>;
      expect(typeof opts.ignored).toBe('function');
      // depth=3 не видел refs/heads/feature/<user>/<task> — коммит из CLI
      // в такую ветку не обновлял граф.
      expect(opts.depth).toBeUndefined();
      fw.dispose();
    });

    it('git-watcher игнорирует .git/index и прочую служебку', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      await waitForWatcher(calls => calls.some(c => c.target.endsWith('.git')));
      const gitCall = watchCalls.find(c => c.target.endsWith('.git'));
      const ignored = (gitCall!.options as { ignored?: (p: string) => boolean }).ignored;
      expect(typeof ignored).toBe('function');

      const matches = (p: string) => ignored!(p);
      // Индекс переписывает наш же `update-index --refresh` — если слушать его,
      // refreshAll запускает сам себя по кругу.
      expect(matches(join(tmpRepo, '.git', 'index'))).toBe(true);
      expect(matches(join(tmpRepo, '.git', 'index.lock'))).toBe(true);
      expect(matches(join(tmpRepo, '.git', 'objects', 'ab', 'cdef'))).toBe(true);
      expect(matches(join(tmpRepo, '.git', 'COMMIT_EDITMSG'))).toBe(true);
      expect(matches(join(tmpRepo, '.git', 'refs', 'heads', 'main.lock'))).toBe(true);

      // А это слушать обязательно — иначе граф не узнает о новых коммитах.
      expect(matches(join(tmpRepo, '.git', 'HEAD'))).toBe(false);
      expect(matches(join(tmpRepo, '.git', 'refs', 'heads', 'main'))).toBe(false);
      expect(matches(join(tmpRepo, '.git', 'packed-refs'))).toBe(false);
      // Ветка с именем "index" не должна попасть под правило про индекс.
      expect(matches(join(tmpRepo, '.git', 'refs', 'heads', 'index'))).toBe(false);
      fw.dispose();
    });

    it('связанный worktree: index в .git/worktrees/<name>/ тоже игнорируется', async () => {
      const { isIgnoredGitPath } = await import('../../src/core/state/FileWatcher');
      // git-dir worktree лежит в основном репо — `/.git/index` в пути нет,
      // старые регексы его не ловили и петля refresh ↔ update-index возвращалась.
      const wtGitDir = join(tmpRepo, '.git', 'worktrees', 'feature');
      expect(isIgnoredGitPath(wtGitDir, join(wtGitDir, 'index'))).toBe(true);
      expect(isIgnoredGitPath(wtGitDir, join(wtGitDir, 'logs', 'HEAD'))).toBe(true);
      expect(isIgnoredGitPath(wtGitDir, join(wtGitDir, 'HEAD'))).toBe(false);
      // В основном репо чужие worktree не будят refresh.
      const mainGitDir = join(tmpRepo, '.git');
      expect(isIgnoredGitPath(mainGitDir, join(mainGitDir, 'worktrees', 'feature', 'index'))).toBe(true);
      expect(isIgnoredGitPath(mainGitDir, join(mainGitDir, 'worktrees', 'feature', 'HEAD'))).toBe(true);
      // Без depth-лимита тяжёлые поддеревья обязаны отсекаться.
      expect(isIgnoredGitPath(mainGitDir, join(mainGitDir, 'modules', 'sub', 'objects', 'ab'))).toBe(true);
      expect(isIgnoredGitPath(mainGitDir, join(mainGitDir, 'lfs', 'objects', 'ab'))).toBe(true);
      // Глубокая ветка — слушаем.
      expect(isIgnoredGitPath(mainGitDir, join(mainGitDir, 'refs', 'heads', 'feature', 'SinkevichRN', 'MISP-298'))).toBe(false);
    });

    it('идемпотентность: повторный addRepo не создаёт дублей', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      fw.addRepo(tmpRepo);
      // ждём, что появилось ровно 2 (git + worktree); если будет больше — позже
      // assert упадёт. waitFor с условием "==2" удерживает тест от ложного
      // прохода если реализация когда-то начнёт лагать.
      await vi.waitFor(() => {
        if (watchCalls.length < 2) throw new Error('not yet created');
      }, { timeout: 1500, interval: 10 });
      // даём ещё один tick, чтобы потенциальный 3-й вызов успел проявиться
      await Promise.resolve();
      expect(watchCalls).toHaveLength(2);
      fw.dispose();
    });
  });

  describe('switchRepo', () => {
    it('задаёт активный путь и поднимает watcher если ещё не был', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.switchRepo(tmpRepo);
      await waitForWatcher(calls => calls.length > 0);
      expect(watchCalls.length).toBeGreaterThan(0);
      fw.dispose();
    });

    it('события от НЕактивных репо игнорируются (refresh не вызывается)', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);

      const otherRepo = mkdtempSync(join(safeTmpDir, 'gitbor-fw-other-'));
      mkdirSync(join(otherRepo, '.git'));
      try {
        fw.addRepo(tmpRepo);
        fw.addRepo(otherRepo);
        fw.switchRepo(tmpRepo);
        // ждём, пока watcher otherRepo точно создан и можно дёргать emit
        await vi.waitFor(() => {
          const ow = createdWatchers.find(w => w.__target === join(otherRepo, '.git'));
          if (!ow) throw new Error('other watcher not yet created');
        }, { timeout: 1500, interval: 10 });

        // отправляем событие из неактивного репо (otherRepo)
        const otherGit = createdWatchers.find(w => w.__target === join(otherRepo, '.git'));
        otherGit!.emit('change');

        // Это negative-проверка: «refresh НЕ должен случиться». Дать debounce
        // (120мс) шанс отстрелять и проверить, что он действительно не вызвал
        // refresh — короткий sleep оправдан семантически (мы ЖДЁМ таймер
        // FileWatcher'а, а не race выполнения). Оборачиваем в waitFor с
        // обратной логикой: за время ожидания counter не должен подняться.
        await new Promise(r => setTimeout(r, 200)); // > GIT_DEBOUNCE_MS (120)
        expect(sm.refreshAll).not.toHaveBeenCalled();
      } finally {
        fw.dispose();
        rmSync(otherRepo, { recursive: true, force: true });
      }
    });

    it('событие из активного git-watcher триггерит invalidate + refreshAll (debounced)', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      fw.switchRepo(tmpRepo);
      await waitForWatcher(calls => calls.some(c => c.target.endsWith('.git')));
      const gitWatcher = createdWatchers.find(w => w.__target.endsWith('.git'));
      gitWatcher!.emit('change');
      // ждём, пока debounce (120мс) отстрелит и refreshAll вызовется.
      // waitFor сам найдёт момент.
      await vi.waitFor(() => {
        expect(sm.invalidateGraphCache).toHaveBeenCalled();
        expect(sm.refreshAll).toHaveBeenCalled();
      }, { timeout: 1500, interval: 10 });
      fw.dispose();
    });

    it('событие из worktree-watcher триггерит refreshStatusAndNotify', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      fw.switchRepo(tmpRepo);
      await waitForWatcher(calls => calls.some(c => c.target === tmpRepo));
      const treeWatcher = createdWatchers.find(w => w.__target === tmpRepo);
      treeWatcher!.emit('change');
      // worktree debounce 200мс.
      await vi.waitFor(() => {
        expect(sm.refreshStatusAndNotify).toHaveBeenCalled();
      }, { timeout: 1500, interval: 10 });
      fw.dispose();
    });
  });

  describe('removeRepo / dispose', () => {
    it('removeRepo: закрывает оба watcher\'а', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      await waitForWatcher(calls =>
        calls.some(c => c.target.endsWith('.git')) && calls.some(c => c.target === tmpRepo),
      );
      const gitW = createdWatchers.find(w => w.__target.endsWith('.git'))!;
      const treeW = createdWatchers.find(w => w.__target === tmpRepo)!;
      fw.removeRepo(tmpRepo);
      await vi.waitFor(() => {
        expect(gitW.close).toHaveBeenCalled();
        expect(treeW.close).toHaveBeenCalled();
      }, { timeout: 1500, interval: 10 });
    });

    it('removeRepo для неизвестного пути — no-op', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      expect(() => fw.removeRepo('/non/existent')).not.toThrow();
    });

    it('dispose: закрывает все watcher\'ы и сбрасывает active', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      fw.switchRepo(tmpRepo);
      await waitForWatcher(calls => calls.some(c => c.target.endsWith('.git')));
      const gitW = createdWatchers.find(w => w.__target.endsWith('.git'))!;
      fw.dispose();
      await vi.waitFor(() => {
        expect(gitW.close).toHaveBeenCalled();
      }, { timeout: 1500, interval: 10 });
    });

    it('unwatch() === dispose() (legacy alias)', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      await waitForWatcher(calls => calls.some(c => c.target.endsWith('.git')));
      const gitW = createdWatchers.find(w => w.__target.endsWith('.git'))!;
      fw.unwatch();
      await vi.waitFor(() => {
        expect(gitW.close).toHaveBeenCalled();
      }, { timeout: 1500, interval: 10 });
    });

    it('race-guard: close во время pre-scan не создаёт orphan watcher', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      fw.removeRepo(tmpRepo); // сразу удаляем плейсхолдер до того, как pre-scan долетит до chokidar.watch
      // Здесь нужен один tick, чтобы pre-scan (setImmediate + readdir) точно
      // прошёл свой race-check `stillTracked` и решил не создавать watcher.
      // Это не "ждём на удачу" — мы ждём ИМЕННО завершения pre-scan, после
      // которого counter уже не должен меняться. Используем короткий sleep
      // как явное "дать pre-scan возможность отработать", после чего
      // верифицируем НЕ-создание (negative invariant).
      await new Promise(r => setTimeout(r, 50));
      expect(watchCalls).toHaveLength(0);
    });
  });
});
