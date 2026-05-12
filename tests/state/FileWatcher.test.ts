import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';

/**
 * Unit-тесты FileWatcher. chokidar полностью мокаем — настоящие watch'ы не
 * запускаем. Реальная fs-папка нужна только чтобы pre-scan (fs.readdir) не
 * падал, а isDangerousRepoRoot честно возвращал false для tmp-папки.
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

vi.mock('chokidar', () => ({
  watch: (target: string, options: unknown) => {
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

function makeFakeStateManager() {
  return {
    invalidateGraphCache: vi.fn(),
    refreshAll: vi.fn(() => Promise.resolve()),
    refreshStatusAndNotify: vi.fn(() => Promise.resolve()),
  };
}

// setImmediate + ждём fs.readdir внутри ensureWatcher. Берём с запасом.
// 150мс — потому что под параллельной нагрузкой `npm test` (55 файлов
// одновременно) 30мс иногда не хватало на цепочку
// setImmediate → fs.readdir → ensureWatcher → mock chokidar.watch().
function flushAsync(ms = 150): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

beforeEach(() => {
  tmpRepo = mkdtempSync(join(tmpdir(), 'skyfork-fw-'));
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
      await flushAsync();
      // git-watcher всегда; worktree-watcher — если не dangerous
      const gitWatch = watchCalls.find(c => c.target.endsWith('.git'));
      const treeWatch = watchCalls.find(c => c.target === tmpRepo);
      expect(gitWatch).toBeDefined();
      expect(treeWatch).toBeDefined();
      fw.dispose();
    });

    it('git-watcher запускается с ignoreInitial и depth=3', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      await flushAsync();
      const gitCall = watchCalls.find(c => c.target.endsWith('.git'));
      const opts = gitCall!.options as Record<string, unknown>;
      expect(opts.ignoreInitial).toBe(true);
      expect(opts.depth).toBe(3);
      fw.dispose();
    });

    it('идемпотентность: повторный addRepo не создаёт дублей', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      fw.addRepo(tmpRepo);
      await flushAsync();
      // git + worktree = 2 watch вызова; не 4.
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
      await flushAsync();
      expect(watchCalls.length).toBeGreaterThan(0);
      fw.dispose();
    });

    it('события от НЕактивных репо игнорируются (refresh не вызывается)', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);

      const otherRepo = mkdtempSync(join(tmpdir(), 'skyfork-fw-other-'));
      mkdirSync(join(otherRepo, '.git'));
      try {
        fw.addRepo(tmpRepo);
        fw.addRepo(otherRepo);
        fw.switchRepo(tmpRepo);
        await flushAsync();

        // отправляем событие из неактивного репо (otherRepo)
        const otherGit = createdWatchers.find(w => w.__target === join(otherRepo, '.git'));
        otherGit!.emit('change');

        await new Promise(r => setTimeout(r, 150));
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
      await flushAsync();
      const gitWatcher = createdWatchers.find(w => w.__target.endsWith('.git'));
      gitWatcher!.emit('change');
      await new Promise(r => setTimeout(r, 150));
      expect(sm.invalidateGraphCache).toHaveBeenCalled();
      expect(sm.refreshAll).toHaveBeenCalled();
      fw.dispose();
    });

    it('событие из worktree-watcher триггерит refreshStatusAndNotify', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      fw.switchRepo(tmpRepo);
      await flushAsync();
      const treeWatcher = createdWatchers.find(w => w.__target === tmpRepo);
      treeWatcher!.emit('change');
      await new Promise(r => setTimeout(r, 250));
      expect(sm.refreshStatusAndNotify).toHaveBeenCalled();
      fw.dispose();
    });
  });

  describe('removeRepo / dispose', () => {
    it('removeRepo: закрывает оба watcher\'а', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      await flushAsync();
      const gitW = createdWatchers.find(w => w.__target.endsWith('.git'))!;
      const treeW = createdWatchers.find(w => w.__target === tmpRepo)!;
      fw.removeRepo(tmpRepo);
      await flushAsync();
      expect(gitW.close).toHaveBeenCalled();
      expect(treeW.close).toHaveBeenCalled();
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
      await flushAsync();
      const gitW = createdWatchers.find(w => w.__target.endsWith('.git'))!;
      fw.dispose();
      await flushAsync();
      expect(gitW.close).toHaveBeenCalled();
    });

    it('unwatch() === dispose() (legacy alias)', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      await flushAsync();
      const gitW = createdWatchers.find(w => w.__target.endsWith('.git'))!;
      fw.unwatch();
      await flushAsync();
      expect(gitW.close).toHaveBeenCalled();
    });

    it('race-guard: close во время pre-scan не создаёт orphan watcher', async () => {
      const { FileWatcher } = await import('../../src/core/state/FileWatcher');
      const sm = makeFakeStateManager();
      const fw = new FileWatcher(sm as never);
      fw.addRepo(tmpRepo);
      fw.removeRepo(tmpRepo); // сразу удаляем плейсхолдер до flushAsync
      await flushAsync();
      // chokidar.watch не должен был стартануть — мы оборвали ensureWatcher
      // на этапе race-проверки `stillTracked`.
      expect(watchCalls).toHaveLength(0);
    });
  });
});
