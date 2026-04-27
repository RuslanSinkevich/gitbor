import * as path from 'path';
import chokidar from 'chokidar';
import { StateManager } from './StateManager';

const GIT_DEBOUNCE_MS = 120;
const WORKTREE_DEBOUNCE_MS = 150;

interface WatcherPair {
  gitWatcher: chokidar.FSWatcher;
  worktreeWatcher: chokidar.FSWatcher;
}

/**
 * Наблюдатель изменений файловой системы для git-репозиториев.
 *
 * Модель: per-repo watchers. Каждое открытое репо имеет свою пару
 * (gitWatcher, worktreeWatcher). switchRepo НЕ пересоздаёт watcher'ы —
 * только меняет активный путь; события от неактивных watcher'ов
 * игнорируются (обновят state когда юзер вернётся на это репо через
 * refreshAll в StateManager.switchRepo).
 *
 * Зачем так: раньше switchRepo делал close() старого watcher'а и watch()
 * нового. На больших worktree (тысячи папок) close() в chokidar имеет
 * тяжёлую синхронную стартовую фазу, а watch() — рекурсивный scan —
 * блокирует main thread на 500-1500мс. При быстром переключении табов
 * большой→маленький юзер видел это как «тормоз переключения».
 * Теперь watcher для репо создаётся один раз при openRepo (или ленивому
 * первому switchRepo) и живёт до closeRepo/dispose.
 */
export class FileWatcher {
  private readonly watchers = new Map<string, WatcherPair>();
  private activeRepoPath: string | null = null;
  private gitDebounce: NodeJS.Timeout | null = null;
  private worktreeDebounce: NodeJS.Timeout | null = null;

  constructor(private readonly stateManager: StateManager) {}

  /**
   * Убедиться, что для репо создан watcher. Идемпотентно.
   * Создание откладывается через setImmediate, чтобы не блокировать
   * текущий tick event loop'а chokidar-scan'ом большого worktree.
   */
  private ensureWatcher(repoPath: string): void {
    if (this.watchers.has(repoPath)) return;
    // Плейсхолдер, чтобы параллельные ensureWatcher для того же пути
    // не создали дубли, пока setImmediate ещё не стрельнул.
    this.watchers.set(repoPath, { gitWatcher: null as never, worktreeWatcher: null as never });

    setImmediate(() => {
      if (this.watchers.get(repoPath)?.gitWatcher) return; // уже создан кем-то ещё
      try {
        const gitDir = path.join(repoPath, '.git');
        const gitWatcher = chokidar.watch(gitDir, {
          ignoreInitial: true,
          depth: 3,
          awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
        });
        const worktreeWatcher = chokidar.watch(repoPath, {
          ignoreInitial: true,
          ignored: [
            /(^|[/\\])\.git([/\\]|$)/,
            /(^|[/\\])node_modules([/\\]|$)/,
            /(^|[/\\])\.DS_Store$/,
            /(^|[/\\])Thumbs\.db$/,
            /(^|[/\\])dist([/\\]|$)/,
            /(^|[/\\])build([/\\]|$)/,
            /(^|[/\\])out([/\\]|$)/,
            /(^|[/\\])target([/\\]|$)/,
            /(^|[/\\])\.next([/\\]|$)/,
            /(^|[/\\])\.cache([/\\]|$)/,
          ],
          depth: 6,
          awaitWriteFinish: false,
        });

        const onGit = () => {
          if (this.activeRepoPath === repoPath) this.scheduleGitRefresh();
        };
        const onTree = () => {
          if (this.activeRepoPath === repoPath) this.scheduleStatusRefresh();
        };
        gitWatcher.on('change', onGit);
        gitWatcher.on('add', onGit);
        gitWatcher.on('unlink', onGit);
        worktreeWatcher.on('change', onTree);
        worktreeWatcher.on('add', onTree);
        worktreeWatcher.on('unlink', onTree);

        this.watchers.set(repoPath, { gitWatcher, worktreeWatcher });
      } catch (err) {
        this.watchers.delete(repoPath);
        console.error('[SkyFork FileWatcher] ensureWatcher failed:', err);
      }
    });
  }

  /**
   * Установить активный репо. Синхронно, не блокирует — только обновляет
   * поле. Создание watcher'а (если ещё нет) откладывается на setImmediate.
   */
  switchRepo(repoPath: string): void {
    this.activeRepoPath = repoPath;
    this.ensureWatcher(repoPath);
  }

  /** Явно добавить репо в слежение (например, при openRepo). */
  addRepo(repoPath: string): void {
    this.ensureWatcher(repoPath);
  }

  /** Убрать репо из слежения (при closeRepo). */
  removeRepo(repoPath: string): void {
    const pair = this.watchers.get(repoPath);
    if (!pair) return;
    this.watchers.delete(repoPath);
    if (this.activeRepoPath === repoPath) this.activeRepoPath = null;
    // close() в setImmediate чтобы не блокировать текущий tick event loop'а.
    setImmediate(() => {
      try {
        pair.gitWatcher?.removeAllListeners();
        pair.worktreeWatcher?.removeAllListeners();
        pair.gitWatcher?.close().catch(() => {});
        pair.worktreeWatcher?.close().catch(() => {});
      } catch { /* ignore */ }
    });
  }

  /** Legacy: полное отключение слежения (используется при закрытии окна). */
  unwatch(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.gitDebounce) { clearTimeout(this.gitDebounce); this.gitDebounce = null; }
    if (this.worktreeDebounce) { clearTimeout(this.worktreeDebounce); this.worktreeDebounce = null; }
    const pairs = Array.from(this.watchers.values());
    this.watchers.clear();
    this.activeRepoPath = null;
    for (const pair of pairs) {
      setImmediate(() => {
        try {
          pair.gitWatcher?.removeAllListeners();
          pair.worktreeWatcher?.removeAllListeners();
          pair.gitWatcher?.close().catch(() => {});
          pair.worktreeWatcher?.close().catch(() => {});
        } catch { /* ignore */ }
      });
    }
  }

  private scheduleGitRefresh(): void {
    if (this.gitDebounce) clearTimeout(this.gitDebounce);
    this.gitDebounce = setTimeout(() => {
      this.gitDebounce = null;
      this.stateManager.invalidateGraphCache();
      this.stateManager.refreshAll().catch((err) => {
        console.error('[SkyFork FileWatcher] refreshAll failed:', err instanceof Error ? err.message : err);
      });
    }, GIT_DEBOUNCE_MS);
  }

  private scheduleStatusRefresh(): void {
    if (this.worktreeDebounce) clearTimeout(this.worktreeDebounce);
    this.worktreeDebounce = setTimeout(() => {
      this.worktreeDebounce = null;
      this.stateManager.refreshStatusAndNotify().catch((err) => {
        console.error('[SkyFork FileWatcher] refreshStatus failed:', err instanceof Error ? err.message : err);
      });
    }, WORKTREE_DEBOUNCE_MS);
  }
}
