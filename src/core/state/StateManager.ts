import { basename } from 'path';
import { GitExecutor } from '../git/GitExecutor';
import * as GitParser from '../git/GitParser';
import { loadGraphCache, saveGraphCache } from './GraphCache';
import { perfMark, perfLog } from '../utils/perf';
import { RepoServicesRegistry, RepoServices } from '../services/RepoServicesRegistry';
import { workerPool } from '../workers/WorkerPool';
import {
  AppState,
  RepoInfo,
} from '../git/types';
import {
  emptyRepoSlice,
  mirrorRepoSliceToAppState,
  GIT_LOG_FORMAT,
  GIT_REF_FORMAT,
  GIT_TAG_REF_FORMAT,
  GIT_STASH_FORMAT,
  hashGitStdout,
  type RepoSlice,
} from './repoSlice';

type StateListener = (state: AppState) => void;
type RepoSwitchListener = (newPath: string) => void;
type RepoCloseListener = (closedPath: string) => void;

export class StateManager {
  private state: AppState;
  private readonly listeners = new Set<StateListener>();
  private readonly repoSwitchListeners = new Set<RepoSwitchListener>();
  private readonly repoCloseListeners = new Set<RepoCloseListener>();
  /**
   * Per-repo срезы. Source of truth для всего, что относится к одному репо
   * (commits, branches, status, cache hashes, token). Активный срез
   * зеркалируется в `this.state` для совместимости с публичным API
   * (`getState()`, `subscribe`).
   */
  private readonly slicesByRepo = new Map<string, RepoSlice>();

  private activeSlice(): RepoSlice | null {
    if (!this.state.repoPath) return null;
    return this.slicesByRepo.get(this.state.repoPath) ?? null;
  }

  /** Получить или создать slice для конкретного репо. */
  private getOrCreateSlice(repoPath: string): RepoSlice {
    let s = this.slicesByRepo.get(repoPath);
    if (!s) {
      s = emptyRepoSlice();
      this.slicesByRepo.set(repoPath, s);
    }
    return s;
  }

  /**
   * Репо «трекается» если оно либо активное, либо в openRepos.
   * После closeRepo путь вылетает из openRepos и активный сменяется —
   * этот гард не даёт фоновому refresh-у пересоздать slice/services
   * закрытого репо (иначе registry.acquire создаст новый GitExecutor
   * на удалённый путь и вызовет утечку процессов).
   */
  private isRepoTracked(repoPath: string): boolean {
    if (this.state.repoPath === repoPath) return true;
    return this.state.openRepos.some(r => r.path === repoPath);
  }

  /**
   * Зеркалирование slice → активный this.state. Вызывается после refresh
   * активного репо, чтобы getState()/subscribe видели свежие данные.
   * Если slice не активного репо — НЕТ зеркала, listeners не дёргаются.
   */
  private mirrorSliceToState(slice: RepoSlice): void {
    mirrorRepoSliceToAppState(this.state, slice);
  }

  constructor(
    /**
     * Реестр per-repo сервисов. Каждое открытое репо имеет свой
     * `GitExecutor` / `OperationQueue` / `SafetyNet`. Все git-операции
     * StateManager идут через активные сервисы (см. `getActiveServices`).
     */
    private readonly registry: RepoServicesRegistry,
  ) {
    this.state = this.emptyState();
  }

  getState(): AppState {
    return this.state;
  }

  /**
   * Сервисы активного репо. Если активного нет — возвращает bootstrap
   * сервисы (используются для clone/init и других операций без открытого
   * репо). Все per-repo refresh*-методы StateManager НЕ должны вызываться
   * когда state.repoPath пуст — они и не вызываются (см. switchRepo).
   */
  getActiveServices(): RepoServices {
    if (!this.state.repoPath) {
      return this.registry.bootstrap();
    }
    return this.registry.acquire(this.state.repoPath);
  }

  /**
   * git активного репо как property для всех `this.git.exec(...)` ниже.
   * Делается через геттер, чтобы не таскать `setCwd` руками.
   */
  private get git(): GitExecutor {
    return this.getActiveServices().git;
  }

  /** Backward-compat: git активного репо. */
  getGit(): GitExecutor {
    return this.git;
  }

  /** Реестр для внешних потребителей (CommandHandler, FileWatcher, AI). */
  getRegistry(): RepoServicesRegistry {
    return this.registry;
  }

  private static readonly INITIAL_COMMIT_LIMIT = 2000;
  /** Первая быстрая выборка графа — сразу виден топ истории. */
  private static readonly PROGRESSIVE_FIRST_LIMIT = 500;
  /** Полная выборка — «весь граф», догружается в бэкграунде. */
  private static readonly PROGRESSIVE_FULL_LIMIT = 50000;

  /**
   * Полное обновление репо: быстрые запросы (ветки/теги/статус) —
   * сразу notify, граф — прогрессивно, двумя фазами.
   *
   * На вызов из switchRepo/autoOpenRepo даёт первый фрейм UI
   * через ~100–300 мс вместо 2–5 сек на больших репо.
   */
  async refreshAll(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.isRepoTracked(target)) return;
    const slice = this.getOrCreateSlice(target);
    const startToken = slice.token;
    const endAll = perfMark('refreshAll.total');
    const endFast = perfMark('refreshAll.fast');
    await this.refreshFast(target);
    endFast();
    if (slice.token !== startToken) { endAll(); return; }
    if (target === this.state.repoPath) {
      this.mirrorSliceToState(slice);
      this.notify();
    }
    await this.refreshGraphProgressive(target, startToken);
    endAll();
  }

  /** Параллельные дешёвые запросы. Без notify. */
  private async refreshFast(repoPath: string): Promise<void> {
    await Promise.all([
      this.refreshBranches(repoPath),
      this.refreshTags(repoPath),
      this.refreshStashes(repoPath),
      this.refreshRemotes(repoPath),
      this.refreshStatus(repoPath),
    ]);
  }

  /**
   * Двухфазная загрузка графа.
   * Фаза A: 500 коммитов — мгновенная отрисовка.
   * Фаза B: до 50k коммитов — плавное расширение истории.
   * После фазы B сохраняем кэш на диск.
   */
  private async refreshGraphProgressive(repoPath: string, startToken: number): Promise<void> {
    const slice = this.getOrCreateSlice(repoPath);
    const endPhaseA = perfMark('refreshGraph.phaseA(500)');
    await this.refreshGraph(StateManager.PROGRESSIVE_FIRST_LIMIT, repoPath);
    endPhaseA();
    if (slice.token !== startToken) return;
    if (repoPath === this.state.repoPath) {
      this.mirrorSliceToState(slice);
      this.notify();
    }

    if (slice.commits.length >= StateManager.PROGRESSIVE_FIRST_LIMIT) {
      const endPhaseB = perfMark('refreshGraph.phaseB(50000)');
      await this.refreshGraph(StateManager.PROGRESSIVE_FULL_LIMIT, repoPath);
      endPhaseB();
      if (slice.token !== startToken) return;
      if (repoPath === this.state.repoPath) {
        this.mirrorSliceToState(slice);
        this.notify();
      }
    }

    if (slice.token !== startToken) return;
    if (slice.cachedHeadHash && slice.commits.length > 0) {
      void saveGraphCache(
        repoPath,
        slice.cachedHeadHash,
        slice.commits,
        slice.graphLayout,
      );
    }
  }

  async refreshBranches(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.isRepoTracked(target)) return;
    const slice = this.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;

    try {
      const localResult = await git.exec([
        'for-each-ref', '--format=' + GIT_REF_FORMAT, 'refs/heads/',
      ]);
      if (slice.token !== startToken) return;
      const localBranches = GitParser.parseBranches(localResult.stdout, false);

      const remoteResult = await git.exec([
        'for-each-ref', '--format=' + GIT_REF_FORMAT, 'refs/remotes/',
      ]);
      if (slice.token !== startToken) return;
      const remoteBranches = GitParser.parseBranches(remoteResult.stdout, true);

      slice.branches = [...localBranches, ...remoteBranches];

      const headResult = await git.exec([
        'rev-parse', '--abbrev-ref', 'HEAD',
      ]);
      if (slice.token !== startToken) return;
      slice.currentBranch = headResult.stdout.trim();

      await this.refreshAheadBehind(target);
    } catch {
      if (slice.token !== startToken) return;
      slice.branches = [];
      slice.currentBranch = '';
    }
    if (isActive) {
      this.state.branches = slice.branches;
      this.state.currentBranch = slice.currentBranch;
      this.state.ahead = slice.ahead;
      this.state.behind = slice.behind;
    }
  }

  /** Refresh status and notify listeners (for standalone calls) */
  async refreshStatusAndNotify(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.isRepoTracked(target)) return;
    const slice = this.getOrCreateSlice(target);
    const startToken = slice.token;
    await this.refreshStatus(target);
    if (slice.token !== startToken) return;
    if (target === this.state.repoPath) this.notify();
  }

  async refreshStatus(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.isRepoTracked(target)) return;
    const slice = this.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;

    try {
      // --untracked-files=normal вместо =all: на huge worktree (например
      // C:\Users\<user> с 440k файлов) `=all` обходит каждый untracked-файл
      // по отдельности и упирается в 30s timeout. `=normal` выводит сами
      // untracked-каталоги без рекурсии — на порядки быстрее, UI получает
      // изменения через секунды, а не через timeout.
      // Цена: untracked-файлы внутри untracked-каталога не показываются
      // отдельными строками — этот edge case покрывается «Show all untracked»
      // на уровне UI (TODO), не дефолтом.
      const statusResult = await git.exec([
        'status', '--porcelain=v1', '--untracked-files=normal',
      ]);
      if (slice.token !== startToken) return;
      // Парсинг 30+ МБ stdout (`C:\Users\Admin` с 440k untracked) синхронно
      // на main thread замораживал IPC. workerPool офлоадит в worker_threads
      // если stdout большой; для маленьких — inline.
      const parsed = workerPool.parseStatus(statusResult.stdout);
      const allFiles = parsed instanceof Promise ? await parsed : parsed;
      if (slice.token !== startToken) return;
      slice.stagedFiles = allFiles.filter(f => f.staged);
      slice.unstagedFiles = allFiles.filter(f => !f.staged);
      slice.conflicts = allFiles.filter(f => f.status === 'U').map(f => f.path);
    } catch {
      if (slice.token !== startToken) return;
      slice.stagedFiles = [];
      slice.unstagedFiles = [];
      slice.conflicts = [];
    }
    if (isActive) {
      this.state.stagedFiles = slice.stagedFiles;
      this.state.unstagedFiles = slice.unstagedFiles;
      this.state.conflicts = slice.conflicts;
    }
  }

  async refreshGraph(maxCount = 0, repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.isRepoTracked(target)) return;
    const slice = this.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;

    try {
      const headResult = await git.exec(['rev-parse', 'HEAD']);
      if (slice.token !== startToken) return;
      const headHash = headResult.stdout.trim();

      const effectiveLimit = maxCount > 0 ? maxCount : StateManager.INITIAL_COMMIT_LIMIT;

      if (headHash === slice.cachedHeadHash && slice.commits.length > 0 && slice.commits.length >= effectiveLimit) {
        perfLog('refreshGraph.skipped.byHead', { limit: effectiveLimit, have: slice.commits.length });
        return;
      }

      const logArgs = ['log', '--all', '--date-order', `--format=${GIT_LOG_FORMAT}`];
      logArgs.push(`--max-count=${effectiveLimit}`);

      const endGitLog = perfMark(`git log(${effectiveLimit})`);
      const logResult = await git.exec(logArgs);
      endGitLog();
      if (slice.token !== startToken) {
        perfLog('refreshGraph.aborted.afterGitLog', { limit: effectiveLimit });
        return;
      }
      perfLog('git log.stdout', { bytes: logResult.stdout.length });

      const stdoutHash = hashGitStdout(logResult.stdout);
      if (
        headHash === slice.cachedHeadHash &&
        slice.cachedLogHash === stdoutHash &&
        slice.cachedLogLimit === effectiveLimit &&
        slice.commits.length > 0
      ) {
        perfLog('refreshGraph.skipped.byStdoutHash', { limit: effectiveLimit, have: slice.commits.length });
        return;
      }

      slice.cachedHeadHash = headHash;
      slice.cachedLogHash = stdoutHash;
      slice.cachedLogLimit = effectiveLimit;

      // 50k коммитов parseCommits + computeGraphLayout — десятки/сотни мс
      // на main thread, подвисало IPC. Офлоадим в worker для крупных репо.
      const commitsParsed = workerPool.parseCommits(logResult.stdout);
      const commits = commitsParsed instanceof Promise ? await commitsParsed : commitsParsed;
      if (slice.token !== startToken) return;
      const layoutParsed = workerPool.computeGraphLayout(commits);
      const layout = layoutParsed instanceof Promise ? await layoutParsed : layoutParsed;
      if (slice.token !== startToken) return;
      slice.commits = commits;
      slice.graphLayout = layout;
    } catch {
      if (slice.token !== startToken) return;
      slice.commits = [];
      slice.graphLayout = { nodes: [], maxColumns: 0, mergeLinks: [] };
      slice.cachedHeadHash = null;
      slice.cachedLogHash = null;
      slice.cachedLogLimit = 0;
    }
    if (isActive) {
      this.state.commits = slice.commits;
      this.state.graphLayout = slice.graphLayout;
    }
  }

  async refreshTags(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.isRepoTracked(target)) return;
    const slice = this.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;
    try {
      const tagResult = await git.exec([
        'for-each-ref', '--sort=-creatordate', '--format=' + GIT_TAG_REF_FORMAT,
        'refs/tags/',
      ]);
      if (slice.token !== startToken) return;
      slice.tags = GitParser.parseTags(tagResult.stdout);
    } catch {
      if (slice.token !== startToken) return;
      slice.tags = [];
    }
    if (isActive) this.state.tags = slice.tags;
  }

  async refreshStashes(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.isRepoTracked(target)) return;
    const slice = this.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;
    try {
      const stashResult = await git.exec([
        'stash', 'list', '--format=' + GIT_STASH_FORMAT,
      ]);
      if (slice.token !== startToken) return;
      slice.stashes = GitParser.parseStashes(stashResult.stdout);
    } catch {
      if (slice.token !== startToken) return;
      slice.stashes = [];
    }
    if (isActive) this.state.stashes = slice.stashes;
  }

  async refreshRemotes(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.isRepoTracked(target)) return;
    const slice = this.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;
    try {
      const remoteResult = await git.exec(['remote', '-v']);
      if (slice.token !== startToken) return;
      slice.remotes = GitParser.parseRemotes(remoteResult.stdout);
    } catch {
      if (slice.token !== startToken) return;
      slice.remotes = [];
    }
    if (isActive) this.state.remotes = slice.remotes;
  }

  async switchRepo(repoPath: string): Promise<void> {
    const endTotal = perfMark(`switchRepo(${basename(repoPath)}).total`);
    perfLog('switchRepo.start', { to: basename(repoPath), from: this.state.repoPath ? basename(this.state.repoPath) : '<empty>' });

    // Гарантируем сервисы и slice для нового активного репо.
    this.registry.acquire(repoPath);
    const newSlice = this.getOrCreateSlice(repoPath);
    const startToken = newSlice.token;

    // Меняем активный путь. Per-repo token нового slice используется для
    // отсечки async-операций именно этого репо (если репо закроют — закрытие
    // увеличит token этого slice, и все его inflight refresh'ы тихо выйдут).
    this.state.repoPath = repoPath;
    this.state.repoName = basename(repoPath);
    const idx = this.state.openRepos.findIndex(r => r.path === repoPath);
    if (idx !== -1) {
      this.state.activeRepoIndex = idx;
      this.state.openRepos = [...this.state.openRepos];
    }

    // Если slice уже наполнен (был открыт раньше) — мгновенно показываем его
    // данные. Иначе остаёмся в пустом срезе, а UI заполнится событиями
    // от refreshAll или дискового graph cache в фоне.
    const hasInMemoryData = newSlice.commits.length > 0 || newSlice.branches.length > 0;
    this.mirrorSliceToState(newSlice);
    perfLog('switchRepo.notify#1(initial)');
    this.notify();

    setImmediate(() => {
      if (newSlice.token !== startToken) return;
      const endSwitch = perfMark('fileWatcher.switchRepo');
      this.notifyRepoSwitch(repoPath);
      endSwitch();
    });

    if (hasInMemoryData) {
      perfLog('switchRepo.inMemorySnapshot', { commits: newSlice.commits.length });
      endTotal();
      queueMicrotask(() => {
        if (newSlice.token !== startToken) return;
        this.refreshAll(repoPath).catch(err => {
          perfLog('refreshAll.background.error', { msg: err instanceof Error ? err.message : String(err) });
        });
      });
      return;
    }

    // Cold path. Дисковый graph cache + refreshAll — в фон.
    endTotal();
    queueMicrotask(() => {
      if (newSlice.token !== startToken) return;
      void this.runSwitchRepoColdPhase(repoPath, startToken);
    });
  }

  private async runSwitchRepoColdPhase(repoPath: string, startToken: number): Promise<void> {
    const slice = this.getOrCreateSlice(repoPath);
    const endLoad = perfMark('switchRepo.loadGraphCache');
    const cache = await loadGraphCache(repoPath);
    endLoad();
    if (slice.token !== startToken) return;
    if (cache) {
      perfLog('switchRepo.cacheHit', { commits: cache.commits.length, nodes: cache.layout.nodes.length });
      slice.commits = cache.commits;
      slice.graphLayout = cache.layout;
      slice.cachedHeadHash = cache.headHash;
      if (repoPath === this.state.repoPath) {
        this.state.commits = slice.commits;
        this.state.graphLayout = slice.graphLayout;
        perfLog('switchRepo.notify#2(cache)');
        this.notify();
      }
    } else {
      perfLog('switchRepo.cacheMiss');
    }
    if (slice.token !== startToken) return;
    this.refreshAll(repoPath).catch(err => {
      perfLog('refreshAll.background.error', { msg: err instanceof Error ? err.message : String(err) });
    });
  }

  setRepoPath(repoPath: string): void {
    this.state.repoPath = repoPath;
    this.state.repoName = basename(repoPath);
    // Убеждаемся, что для этого репо есть per-repo сервисы.
    this.registry.acquire(repoPath);

    if (!this.state.openRepos.some(r => r.path === repoPath)) {
      this.state.openRepos = [
        ...this.state.openRepos,
        { name: basename(repoPath), path: repoPath },
      ];
      this.state.activeRepoIndex = this.state.openRepos.length - 1;
    }
  }

  setOpenRepos(repos: RepoInfo[]): void {
    this.state.openRepos = repos;
  }

  clearRepo(): void {
    // Инвалидируем все running async-ops активного slice — они тихо выйдут.
    const active = this.activeSlice();
    if (active) active.token++;
    this.state = this.emptyState();
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

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onRepoSwitch(listener: RepoSwitchListener): () => void {
    this.repoSwitchListeners.add(listener);
    return () => {
      this.repoSwitchListeners.delete(listener);
    };
  }

  onRepoClose(listener: RepoCloseListener): () => void {
    this.repoCloseListeners.add(listener);
    return () => {
      this.repoCloseListeners.delete(listener);
    };
  }

  /**
   * Публично вызывается из CommandHandler.closeRepo после удаления
   * репо из openRepos. Потребители (FileWatcher, MessageBridge) могут
   * освободить связанные с путём ресурсы.
   */
  notifyRepoClose(closedPath: string): void {
    // Инвалидируем slice закрытого репо: бампим его token, чтобы все
    // inflight refresh операции тихо выйдут. Затем удаляем slice.
    const slice = this.slicesByRepo.get(closedPath);
    if (slice) slice.token++;
    this.slicesByRepo.delete(closedPath);
    try { this.registry.release(closedPath); } catch { /* ignore */ }
    for (const listener of this.repoCloseListeners) {
      try {
        listener(closedPath);
      } catch {
        // listener error — don't crash state manager
      }
    }
  }

  invalidateGraphCache(repoPath?: string): void {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    const slice = this.slicesByRepo.get(target);
    if (!slice) return;
    slice.cachedHeadHash = null;
    slice.cachedLogHash = null;
    slice.cachedLogLimit = 0;
  }

  private notifyRepoSwitch(newPath: string): void {
    for (const listener of this.repoSwitchListeners) {
      try {
        listener(newPath);
      } catch {
        // listener error — don't crash state manager
      }
    }
  }

  private async refreshAheadBehind(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.isRepoTracked(target)) return;
    const slice = this.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    try {
      const result = await git.exec([
        'rev-list', '--left-right', '--count', 'HEAD...@{upstream}',
      ]);
      if (slice.token !== startToken) return;
      const parts = result.stdout.trim().split('\t');
      slice.ahead = parseInt(parts[0], 10) || 0;
      slice.behind = parseInt(parts[1], 10) || 0;
    } catch {
      if (slice.token !== startToken) return;
      slice.ahead = 0;
      slice.behind = 0;
    }
  }

  private notify(): void {
    // Shallow-копия верхнего уровня — React-потребители сравнивают ссылки на
    // массивы (commits/graphLayout/branches), а они уже свежие на момент notify.
    const snapshot: AppState = { ...this.state };
    perfLog('notify', { commits: snapshot.commits.length, nodes: snapshot.graphLayout.nodes.length, listeners: this.listeners.size });
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // listener error — don't crash state manager
      }
    }
  }

  private emptyState(): AppState {
    return {
      repoPath: '',
      repoName: '',
      currentBranch: '',
      branches: [],
      tags: [],
      stashes: [],
      remotes: [],
      stagedFiles: [],
      unstagedFiles: [],
      conflicts: [],
      ahead: 0,
      behind: 0,
      commits: [],
      graphLayout: { nodes: [], maxColumns: 0, mergeLinks: [] },
      selectedCommitHash: null,
      isOperationRunning: false,
      currentOperation: null,
      openRepos: [],
      activeRepoIndex: 0,
    };
  }
}
