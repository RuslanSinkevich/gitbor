import * as path from 'path';
import * as fs from 'fs/promises';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import { StateManager } from './StateManager';
import { isDangerousRepoRoot } from '../utils/repoPathGuard';
import { mainLogger } from '../utils/Logger';

const GIT_DEBOUNCE_MS = 120;
const WORKTREE_DEBOUNCE_MS = 200;
/**
 * Если в корне репозитория больше этого числа записей верхнего уровня —
 * worktreeWatcher НЕ запускается. На профильных каталогах chokidar пытается
 * рекурсивно сканировать сотни тысяч файлов, выдаёт EPERM на системные
 * подкаталоги и замораживает main thread.
 * .git-watcher остаётся активным, чтобы реагировать на ref/HEAD/index.
 *
 * Понижено с 5000 → 1000: типичная домашняя папка имеет 30-200 записей
 * верхнего уровня (старый порог 5000 её НЕ ловил), но за ними скрыты сотни
 * тысяч файлов. 1000 безопасно: все нормальные репо проходят, а на
 * сомнительных лучше пожертвовать живыми обновлениями worktree, чем
 * получить заморозку.
 */
const WORKTREE_TOPLEVEL_LIMIT = 1000;

interface WatcherPair {
  gitWatcher: FSWatcher;
  worktreeWatcher: FSWatcher | null;
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
  /**
   * Когда окно свёрнуто/скрыто (см. main.ts → 'minimize'/'hide'), главный
   * процесс ставит watcher на паузу: события chokidar по-прежнему приходят,
   * но debounced refresh'и не запускаются. Сами FSWatcher не закрываем —
   * close()/watch() для большого worktree блокирует main thread на сотни
   * мс, и каждое сворачивание окна давало бы видимый рывок при restore.
   * Pending-события chokidar держит сам, но без нашего refreshAll они не
   * порождают git-команды и не растят renderer-heap.
   */
  private paused = false;
  private pendingGitRefresh = false;
  private pendingWorktreeRefresh = false;

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

    void (async () => {
      if (this.watchers.get(repoPath)?.gitWatcher) return; // уже создан кем-то ещё

      // Pre-scan: смотрим количество записей в корне. Если их слишком много —
      // считаем репо «гигантским» (типичный признак — открыли C:\Users\<USER>
      // или другой системный каталог) и подписываемся ТОЛЬКО на .git.
      // Дополнительный hard-stop: dangerous-пути (домашка, корень диска,
      // C:\Windows и т.п.) — worktreeWatcher НЕ запускаем независимо
      // от количества записей, чтобы не уйти в EPERM-цикл по AppData/Cookies.
      let isHugeWorktree = false;
      const isDangerous = isDangerousRepoRoot(repoPath).dangerous;
      try {
        const entries = await fs.readdir(repoPath);
        const topLevelCount = entries.length;
        isHugeWorktree = topLevelCount > WORKTREE_TOPLEVEL_LIMIT;
        if (isHugeWorktree) {
          mainLogger.warn(
            `FileWatcher: worktreeWatcher disabled for ${repoPath} (${topLevelCount} top-level entries > ${WORKTREE_TOPLEVEL_LIMIT}). Only .git is watched.`,
          );
        }
      } catch (err) {
        mainLogger.warn(`FileWatcher: pre-scan failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (isDangerous) {
        mainLogger.warn(`FileWatcher: worktreeWatcher disabled — ${repoPath} is a system/home directory.`);
        isHugeWorktree = true;
      }

      // Race-guard: репо могли закрыть, пока шёл async fs.readdir. В этом
      // случае placeholder уже удалён `removeRepo` — создавать chokidar не
      // надо, иначе получим orphan-watcher без ссылок и без close().
      const stillTracked = this.watchers.has(repoPath);
      if (!stillTracked) return;
      if (this.watchers.get(repoPath)?.gitWatcher) return;

      try {
        const gitDir = path.join(repoPath, '.git');
        const gitWatcher = chokidarWatch(gitDir, {
          ignoreInitial: true,
          depth: 3,
          awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
        });
        const worktreeWatcher: FSWatcher | null = isHugeWorktree ? null : chokidarWatch(repoPath, {
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
            // Системные/запрещённые директории Windows — chokidar при попытке
            // watch'ить их кидает EPERM/EACCES → unhandledRejection. Возникает
            // когда юзер случайно открывает корень профиля (C:\Users\Admin),
            // OneDrive, AppData. Эти регексы матчатся по абсолютному пути.
            /[\\/]AppData[\\/]/,
            /[\\/]Application Data[\\/]/i,
            /[\\/]Local Settings[\\/]/i,
            /[\\/]NTUSER\.DAT/i,
            /[\\/]Cookies[\\/]/i,
            /[\\/]Temporary Internet Files[\\/]/i,
            /[\\/]WindowsApps[\\/]/i,
            /[\\/]\$Recycle\.Bin[\\/]/i,
            /[\\/]System Volume Information[\\/]/i,
            /[\\/]OneDrive[\\/]/i,
          ],
          // Без `depth`: при лимите (раньше было 3) chokidar не вешал
          // watcher на файлы глубже N уровней — правки в рабочей копии не
          // давали fs-событий, «Не подготовлено» замирало до внешнего refresh
          // (switchRepo → refreshAll и т.п.). EPERM по мусорным путям режем
          // `ignored`; гигантские корни уже отсекаются отключением worktreeWatcher.
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
        if (worktreeWatcher) {
          worktreeWatcher.on('change', onTree);
          worktreeWatcher.on('add', onTree);
          worktreeWatcher.on('unlink', onTree);
        }

        // Без 'error'-листенера chokidar при EPERM/EACCES (системные папки в
        // профиле, OneDrive, защищённые директории) кидает unhandledRejection
        // и валит main. Свой listener — глотаем.
        const onWatcherError = (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          mainLogger.warn(`FileWatcher: chokidar error: ${msg}`);
        };
        gitWatcher.on('error', onWatcherError);
        worktreeWatcher?.on('error', onWatcherError);

        // Финальная race-проверка: если за время инициализации chokidar
        // (несколько мс на больших worktree) репо успели закрыть —
        // немедленно закрываем созданные watcher'ы, чтобы не утекли.
        if (!this.watchers.has(repoPath)) {
          gitWatcher.removeAllListeners();
          worktreeWatcher?.removeAllListeners();
          gitWatcher.close().catch(() => {});
          worktreeWatcher?.close().catch(() => {});
          return;
        }
        this.watchers.set(repoPath, { gitWatcher, worktreeWatcher });
      } catch (err) {
        this.watchers.delete(repoPath);
        mainLogger.error(`FileWatcher: ensureWatcher failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      }
    })();
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

  /**
   * Идёт ли сейчас write-операция (commit/stage/merge/...) на активном репо.
   * Read'ы в OperationQueue ходят ПАРАЛЛЕЛЬНО с write'ом, поэтому
   * watcher-driven refresh, выстреливший в середине коммита, читает git
   * status на полуразобранном индексе и показывает промежуточное состояние
   * («Не подготовлено» мигает и тут же исчезает). Сама write-операция
   * делает свой refresh по завершении — watcher-refresh в это время лишний
   * и вреден. Поэтому при активном write мы откладываем refresh.
   */
  private isActiveRepoWriting(): boolean {
    const repo = this.activeRepoPath;
    if (!repo) return false;
    try {
      return this.stateManager.getRegistry().acquire(repo).queue.isWriteRunning();
    } catch {
      return false;
    }
  }

  private scheduleGitRefresh(): void {
    if (this.paused) {
      // Запомним, что были события, чтобы на resume однократно догнать состояние.
      this.pendingGitRefresh = true;
      return;
    }
    if (this.gitDebounce) clearTimeout(this.gitDebounce);
    this.gitDebounce = setTimeout(() => {
      this.gitDebounce = null;
      // Идёт write — переарм debounce и ждём его завершения, иначе словим
      // мигание промежуточного status'а во время коммита/стейджа.
      if (this.isActiveRepoWriting()) {
        this.scheduleGitRefresh();
        return;
      }
      this.stateManager.invalidateGraphCache();
      this.stateManager.refreshAll().catch((err) => {
        mainLogger.error(`FileWatcher: refreshAll failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, GIT_DEBOUNCE_MS);
  }

  private scheduleStatusRefresh(): void {
    if (this.paused) {
      this.pendingWorktreeRefresh = true;
      return;
    }
    if (this.worktreeDebounce) clearTimeout(this.worktreeDebounce);
    this.worktreeDebounce = setTimeout(() => {
      this.worktreeDebounce = null;
      if (this.isActiveRepoWriting()) {
        this.scheduleStatusRefresh();
        return;
      }
      this.stateManager.refreshStatusAndNotify().catch((err) => {
        mainLogger.error(`FileWatcher: refreshStatus failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, WORKTREE_DEBOUNCE_MS);
  }

  /**
   * Поставить watcher на паузу. Активные debounce-таймеры дочищаем, чтобы
   * не выстрелили после minimize. Сами chokidar-watchers НЕ закрываем —
   * на больших worktree их пересоздание стоит сотни мс и видится как
   * рывок при restore. События продолжают приходить, но только взводят
   * флаги `pendingGitRefresh`/`pendingWorktreeRefresh`.
   */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.gitDebounce) { clearTimeout(this.gitDebounce); this.gitDebounce = null; }
    if (this.worktreeDebounce) { clearTimeout(this.worktreeDebounce); this.worktreeDebounce = null; }
    mainLogger.debug('FileWatcher: paused');
  }

  /**
   * Снять с паузы. Если пока окно было скрыто были fs-события — делаем
   * один догоняющий refreshAll по активному репо. Без этого вкладка
   * показала бы устаревший status/log сразу после восстановления.
   */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    mainLogger.debug('FileWatcher: resumed');
    const needRefresh = this.pendingGitRefresh || this.pendingWorktreeRefresh;
    this.pendingGitRefresh = false;
    this.pendingWorktreeRefresh = false;
    if (needRefresh && this.activeRepoPath) {
      this.stateManager.invalidateGraphCache();
      this.stateManager.refreshAll().catch((err) => {
        mainLogger.error(`FileWatcher: resume refreshAll failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }
}
