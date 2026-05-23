import { basename } from 'path';
import { GitExecutor } from '../git/GitExecutor';
import { perfMark, perfLog } from '../utils/perf';
import { RepoServicesRegistry, RepoServices } from '../services/RepoServicesRegistry';
import {
  AppState,
  RepoInfo,
} from '../git/types';
import { RepoSlicesStore } from './RepoSlicesStore';
import { RepoStateRefresher } from './RepoStateRefresher';
import { RepoEventBus } from './RepoEventBus';

/**
 * StateManager — фасад над тремя независимыми модулями:
 *
 * - `RepoSlicesStore`     — per-repo срезы и meta (active, openRepos).
 * - `RepoStateRefresher`  — все async refresh-методы (git → slice).
 * - `RepoEventBus`        — три канала подписок (state / switch / close).
 *
 * Публичный API не менялся: все потребители (CommandHandler, MessageBridge,
 * FileWatcher, recovery) видят прежнюю поверхность. Делегируем внутрь.
 */
export class StateManager {
  private readonly store = new RepoSlicesStore();
  private readonly bus = new RepoEventBus();
  private readonly refresher: RepoStateRefresher;

  constructor(
    /**
     * Реестр per-repo сервисов. Каждое открытое репо имеет свой
     * `GitExecutor` / `OperationQueue` / `SafetyNet`. Все git-операции
     * StateManager идут через активные сервисы (см. `getActiveServices`).
     */
    private readonly registry: RepoServicesRegistry,
  ) {
    this.refresher = new RepoStateRefresher(this.store, this.registry, () => this.notify());
  }

  getState(): AppState {
    return this.store.getState();
  }

  /**
   * Сервисы активного репо. Если активного нет — возвращает bootstrap
   * сервисы (используются для clone/init и других операций без открытого
   * репо). Все per-repo refresh*-методы StateManager НЕ должны вызываться
   * когда state.repoPath пуст — они и не вызываются (см. switchRepo).
   */
  getActiveServices(): RepoServices {
    const repoPath = this.store.getState().repoPath;
    if (!repoPath) {
      return this.registry.bootstrap();
    }
    return this.registry.acquire(repoPath);
  }

  /** Backward-compat: git активного репо. */
  getGit(): GitExecutor {
    return this.getActiveServices().git;
  }

  /** Реестр для внешних потребителей (CommandHandler, FileWatcher, AI). */
  getRegistry(): RepoServicesRegistry {
    return this.registry;
  }

  refreshAll(repoPath?: string, opts?: { deferHeavy?: boolean }): Promise<void> {
    return this.refresher.refreshAll(repoPath, opts);
  }

  refreshBranches(repoPath?: string): Promise<void> {
    return this.refresher.refreshBranches(repoPath);
  }

  refreshStatusAndNotify(repoPath?: string): Promise<void> {
    return this.refresher.refreshStatusAndNotify(repoPath);
  }

  refreshStatus(repoPath?: string): Promise<void> {
    return this.refresher.refreshStatus(repoPath);
  }

  refreshStatIndex(repoPath?: string): Promise<void> {
    return this.refresher.refreshStatIndex(repoPath);
  }

  refreshGraph(maxCount = 0, repoPath?: string): Promise<void> {
    return this.refresher.refreshGraph(maxCount, repoPath);
  }

  refreshTags(repoPath?: string): Promise<void> {
    return this.refresher.refreshTags(repoPath);
  }

  refreshStashes(repoPath?: string): Promise<void> {
    return this.refresher.refreshStashes(repoPath);
  }

  refreshRemotes(repoPath?: string): Promise<void> {
    return this.refresher.refreshRemotes(repoPath);
  }

  async switchRepo(repoPath: string): Promise<void> {
    const endTotal = perfMark(`switchRepo(${basename(repoPath)}).total`);
    const fromPath = this.store.getState().repoPath;
    perfLog('switchRepo.start', { to: basename(repoPath), from: fromPath ? basename(fromPath) : '<empty>' });

    // Гарантируем сервисы для нового активного репо.
    this.registry.acquire(repoPath);
    // Активируем slice + меняем активный путь + обновляем openRepos index +
    // зеркалим slice → state. Если slice ещё пустой — UI остаётся пустым,
    // данные подтянет refreshAll/cold phase.
    const newSlice = this.store.activateRepo(repoPath);

    // Eviction тяжёлых данных у НЕАКТИВНЫХ табов: graph (commits+layout)
    // занимает 5-50 MB на репо. Раньше держали бессрочно «на всякий
    // случай быстрого возврата» — на 3-х монорепо это уже 150+ MB,
    // которые Electron не возвращает ОС. При возврате на таб делается
    // быстрый refreshAll, deferHeavy подтягивает граф — UI usable
    // через сотни мс, не блокирует.
    for (const otherPath of this.store.trackedRepoPaths()) {
      if (otherPath !== repoPath) this.store.evictGraphData(otherPath);
    }
    const startToken = newSlice.token;
    const hasInMemoryData = newSlice.commits.length > 0 || newSlice.branches.length > 0;

    perfLog('switchRepo.notify#1(initial)');
    this.notify();

    setImmediate(() => {
      if (newSlice.token !== startToken) return;
      const endSwitch = perfMark('fileWatcher.switchRepo');
      this.bus.notifyRepoSwitch(repoPath);
      endSwitch();
    });

    if (hasInMemoryData) {
      perfLog('switchRepo.inMemorySnapshot', { commits: newSlice.commits.length });
      endTotal();
      queueMicrotask(() => {
        if (newSlice.token !== startToken) return;
        this.refresher.refreshAll(repoPath).catch(err => {
          perfLog('refreshAll.background.error', { msg: err instanceof Error ? err.message : String(err) });
        });
      });
      return;
    }

    // Cold path. Дисковый graph cache + refreshAll — в фон.
    endTotal();
    queueMicrotask(() => {
      if (newSlice.token !== startToken) return;
      void this.refresher.runSwitchRepoColdPhase(repoPath, startToken);
    });
  }

  setRepoPath(repoPath: string): void {
    this.store.setRepoPath(repoPath);
    // Убеждаемся, что для этого репо есть per-repo сервисы.
    this.registry.acquire(repoPath);
  }

  setOpenRepos(repos: RepoInfo[]): void {
    this.store.setOpenRepos(repos);
  }

  clearRepo(): void {
    this.store.clearRepo();
    this.notify();
  }

  /**
   * @deprecated Глобальный флаг «идёт операция» больше не используется:
   * renderer держит per-repo `runningOpsByRepo`. Метод оставлен пустым,
   * чтобы внешние подписчики (если кто-то ещё вызывает) не падали.
   * При следующем рефакторинге удалить вместе с полями
   * `state.isOperationRunning`/`currentOperation`.
   */
  setOperationRunning(_running: boolean, _operation: string | null): void {
    // no-op
  }

  subscribe(listener: (state: AppState) => void): () => void {
    return this.bus.subscribe(listener);
  }

  onRepoSwitch(listener: (newPath: string) => void): () => void {
    return this.bus.onRepoSwitch(listener);
  }

  onRepoClose(listener: (closedPath: string) => void): () => void {
    return this.bus.onRepoClose(listener);
  }

  /**
   * Публично вызывается из CommandHandler.closeRepo после удаления
   * репо из openRepos. Потребители (FileWatcher, MessageBridge) могут
   * освободить связанные с путём ресурсы.
   */
  notifyRepoClose(closedPath: string): void {
    // Инвалидируем slice закрытого репо: бамп token + удаление, чтобы все
    // inflight refresh операции тихо вышли.
    this.store.removeSlice(closedPath);
    try { this.registry.release(closedPath); } catch { /* ignore */ }
    this.bus.notifyRepoClose(closedPath);
  }

  invalidateGraphCache(repoPath?: string): void {
    this.refresher.invalidateGraphCache(repoPath);
  }

  private notify(): void {
    // Shallow-копия верхнего уровня — React-потребители сравнивают ссылки на
    // массивы (commits/graphLayout/branches), а они уже свежие на момент notify.
    const snapshot: AppState = { ...this.store.getState() };
    perfLog('notify', {
      commits: snapshot.commits.length,
      nodes: snapshot.graphLayout.nodes.length,
      listeners: this.bus.stateListenerCount,
    });
    this.bus.notify(snapshot);
  }
}
