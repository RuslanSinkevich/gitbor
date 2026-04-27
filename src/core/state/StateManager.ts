import { basename } from 'path';
import { createHash } from 'crypto';
import { GitExecutor } from '../git/GitExecutor';
import * as GitParser from '../git/GitParser';
import { computeGraphLayout } from '../git/GraphLayout';
import { loadGraphCache, saveGraphCache } from './GraphCache';
import { perfMark, perfLog } from '../utils/perf';
import {
  AppState,
  Commit,
  RepoInfo,
} from '../git/types';

type StateListener = (state: AppState) => void;
type RepoSwitchListener = (newPath: string) => void;
type RepoCloseListener = (closedPath: string) => void;
type RepoSnapshot = Pick<
  AppState,
  | 'currentBranch'
  | 'branches'
  | 'tags'
  | 'stashes'
  | 'remotes'
  | 'stagedFiles'
  | 'unstagedFiles'
  | 'conflicts'
  | 'ahead'
  | 'behind'
  | 'commits'
  | 'graphLayout'
  | 'selectedCommitHash'
> & {
  headHash: string | null;
  logHash: string | null;
  logLimit: number;
};

const LOG_FORMAT =
  '%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s%x00%G?';
const REF_FORMAT =
  '%(refname:short)%00%(objectname)%00%(upstream:short)%00%(HEAD)';
const TAG_REF_FORMAT =
  '%(refname:short)%00%(objectname)';
const STASH_FORMAT =
  '%gd%x00%H%x00%gs';

export class StateManager {
  private state: AppState;
  private cachedHeadHash: string | null = null;
  /**
   * Хэш последнего `git log` stdout + применённого лимита.
   * Если на повторном refreshGraph stdout совпал byte-to-byte и лимит тот же —
   * пропускаем parseCommits + computeGraphLayout и, главное, НЕ меняем ссылки
   * на state.commits / state.graphLayout. Это гасит лишние graphData-send'ы
   * и тяжёлый groupBranchPaths в renderer.
   */
  private cachedLogHash: string | null = null;
  private cachedLogLimit: number = 0;
  private readonly listeners = new Set<StateListener>();
  private readonly repoSwitchListeners = new Set<RepoSwitchListener>();
  private readonly repoCloseListeners = new Set<RepoCloseListener>();
  private readonly repoSnapshots = new Map<string, RepoSnapshot>();
  /**
   * Монотонный токен, инкрементится на каждый switchRepo/clearRepo.
   * Любая async-операция, которая планирует писать в state,
   * должна сверить свой захваченный токен с текущим и молча выйти,
   * если репо уже сменилось. Иначе копится race + утечки памяти.
   */
  private repoToken = 0;

  constructor(
    private readonly git: GitExecutor
  ) {
    this.state = this.emptyState();
  }

  getState(): AppState {
    return this.state;
  }

  getGit(): GitExecutor {
    return this.git;
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
  async refreshAll(): Promise<void> {
    const token = this.repoToken;
    const endAll = perfMark('refreshAll.total');
    const endFast = perfMark('refreshAll.fast');
    await this.refreshFast();
    endFast();
    if (token !== this.repoToken) { endAll(); return; }
    this.notify();
    await this.refreshGraphProgressive(token);
    endAll();
  }

  /** Параллельные дешёвые запросы. Без notify. */
  private async refreshFast(): Promise<void> {
    await Promise.all([
      this.refreshBranches(),
      this.refreshTags(),
      this.refreshStashes(),
      this.refreshRemotes(),
      this.refreshStatus(),
    ]);
  }

  /**
   * Двухфазная загрузка графа.
   * Фаза A: 500 коммитов — мгновенная отрисовка.
   * Фаза B: до 50k коммитов — плавное расширение истории.
   * После фазы B сохраняем кэш на диск.
   */
  private async refreshGraphProgressive(token: number): Promise<void> {
    const endPhaseA = perfMark('refreshGraph.phaseA(500)');
    await this.refreshGraph(StateManager.PROGRESSIVE_FIRST_LIMIT);
    endPhaseA();
    if (token !== this.repoToken) return;
    this.notify();

    if (this.state.commits.length >= StateManager.PROGRESSIVE_FIRST_LIMIT) {
      const endPhaseB = perfMark('refreshGraph.phaseB(50000)');
      await this.refreshGraph(StateManager.PROGRESSIVE_FULL_LIMIT);
      endPhaseB();
      if (token !== this.repoToken) return;
      this.notify();
    }

    if (token !== this.repoToken) return;
    if (this.cachedHeadHash && this.state.commits.length > 0 && this.state.repoPath) {
      void saveGraphCache(
        this.state.repoPath,
        this.cachedHeadHash,
        this.state.commits,
        this.state.graphLayout,
      );
    }
  }

  async refreshBranches(): Promise<void> {
    const token = this.repoToken;
    try {
      const localResult = await this.git.exec([
        'for-each-ref', '--format=' + REF_FORMAT, 'refs/heads/',
      ]);
      if (token !== this.repoToken) return;
      const localBranches = GitParser.parseBranches(localResult.stdout, false);

      const remoteResult = await this.git.exec([
        'for-each-ref', '--format=' + REF_FORMAT, 'refs/remotes/',
      ]);
      if (token !== this.repoToken) return;
      const remoteBranches = GitParser.parseBranches(remoteResult.stdout, true);

      this.state.branches = [...localBranches, ...remoteBranches];

      const headResult = await this.git.exec([
        'rev-parse', '--abbrev-ref', 'HEAD',
      ]);
      if (token !== this.repoToken) return;
      this.state.currentBranch = headResult.stdout.trim();

      await this.refreshAheadBehind();
    } catch {
      if (token !== this.repoToken) return;
      this.state.branches = [];
      this.state.currentBranch = '';
    }
  }

  /** Refresh status and notify listeners (for standalone calls) */
  async refreshStatusAndNotify(): Promise<void> {
    const token = this.repoToken;
    await this.refreshStatus();
    if (token !== this.repoToken) return;
    this.notify();
  }

  async refreshStatus(): Promise<void> {
    const token = this.repoToken;
    try {
      const statusResult = await this.git.exec([
        'status', '--porcelain=v1', '--untracked-files=all',
      ]);
      if (token !== this.repoToken) return;
      const allFiles = GitParser.parseStatus(statusResult.stdout);
      this.state.stagedFiles = allFiles.filter(f => f.staged);
      this.state.unstagedFiles = allFiles.filter(f => !f.staged);

      this.state.conflicts = allFiles
        .filter(f => f.status === 'U')
        .map(f => f.path);
    } catch {
      if (token !== this.repoToken) return;
      this.state.stagedFiles = [];
      this.state.unstagedFiles = [];
      this.state.conflicts = [];
    }
  }

  async refreshGraph(maxCount = 0): Promise<void> {
    // Захватываем токен в начале. Если репо сменится посреди работы —
    // все проверки ниже заставят метод тихо выйти до записи в state,
    // чтобы старый refreshGraph не затёр данные нового репо.
    const token = this.repoToken;
    try {
      const headResult = await this.git.exec(['rev-parse', 'HEAD']);
      if (token !== this.repoToken) return;
      const headHash = headResult.stdout.trim();

      const effectiveLimit = maxCount > 0 ? maxCount : StateManager.INITIAL_COMMIT_LIMIT;

      // Быстрый fast-path: headHash не двигался И у нас уже есть данные ≥ запрошенного лимита.
      // Самый частый сценарий при switchRepo между снапшотами.
      if (headHash === this.cachedHeadHash && this.state.commits.length > 0 && this.state.commits.length >= effectiveLimit) {
        perfLog('refreshGraph.skipped.byHead', { limit: effectiveLimit, have: this.state.commits.length });
        return;
      }

      const logArgs = ['log', '--all', '--date-order', `--format=${LOG_FORMAT}`];
      logArgs.push(`--max-count=${effectiveLimit}`);

      const endGitLog = perfMark(`git log(${effectiveLimit})`);
      const logResult = await this.git.exec(logArgs);
      endGitLog();
      if (token !== this.repoToken) {
        perfLog('refreshGraph.aborted.afterGitLog', { limit: effectiveLimit });
        return;
      }
      perfLog('git log.stdout', { bytes: logResult.stdout.length });

      // Второй fast-path: stdout совпал byte-to-byte с предыдущим для такого же лимита.
      // Это ловит случай "repoA → repoB → repoA" когда после switchRepo гоняется refreshGraph
      // поверх snapshot-а, данные идентичны, но массив бы пересоздался.
      const stdoutHash = hashString(logResult.stdout);
      if (
        headHash === this.cachedHeadHash &&
        this.cachedLogHash === stdoutHash &&
        this.cachedLogLimit === effectiveLimit &&
        this.state.commits.length > 0
      ) {
        perfLog('refreshGraph.skipped.byStdoutHash', { limit: effectiveLimit, have: this.state.commits.length });
        return;
      }

      this.cachedHeadHash = headHash;
      this.cachedLogHash = stdoutHash;
      this.cachedLogLimit = effectiveLimit;

      this.state.commits = GitParser.parseCommits(logResult.stdout);
      this.state.graphLayout = computeGraphLayout(this.state.commits as Commit[]);
    } catch {
      if (token !== this.repoToken) return;
      this.state.commits = [];
      this.state.graphLayout = { nodes: [], maxColumns: 0, mergeLinks: [] };
      this.cachedHeadHash = null;
      this.cachedLogHash = null;
      this.cachedLogLimit = 0;
    }
  }

  async refreshTags(): Promise<void> {
    const token = this.repoToken;
    try {
      const tagResult = await this.git.exec([
        'for-each-ref', '--sort=-creatordate', '--format=' + TAG_REF_FORMAT,
        'refs/tags/',
      ]);
      if (token !== this.repoToken) return;
      this.state.tags = GitParser.parseTags(tagResult.stdout);
    } catch {
      if (token !== this.repoToken) return;
      this.state.tags = [];
    }
  }

  async refreshStashes(): Promise<void> {
    const token = this.repoToken;
    try {
      const stashResult = await this.git.exec([
        'stash', 'list', '--format=' + STASH_FORMAT,
      ]);
      if (token !== this.repoToken) return;
      this.state.stashes = GitParser.parseStashes(stashResult.stdout);
    } catch {
      if (token !== this.repoToken) return;
      this.state.stashes = [];
    }
  }

  async refreshRemotes(): Promise<void> {
    const token = this.repoToken;
    try {
      const remoteResult = await this.git.exec(['remote', '-v']);
      if (token !== this.repoToken) return;
      this.state.remotes = GitParser.parseRemotes(remoteResult.stdout);
    } catch {
      if (token !== this.repoToken) return;
      this.state.remotes = [];
    }
  }

  async switchRepo(repoPath: string): Promise<void> {
    const endTotal = perfMark(`switchRepo(${basename(repoPath)}).total`);
    perfLog('switchRepo.start', { to: basename(repoPath), from: this.state.repoPath ? basename(this.state.repoPath) : '<empty>' });

    // Snapshot сохраняем только если реально уходим с другого репо.
    // openRepo() делает setRepoPath() ДО switchRepo() — в этом случае
    // this.state.repoPath уже равен новому repoPath, и сохранять нечего.
    if (this.state.repoPath && this.state.repoPath !== repoPath) {
      this.repoSnapshots.set(this.state.repoPath, this.captureRepoSnapshot());
    }

    // Инвалидируем все running async-операции предыдущего репо.
    this.repoToken++;
    const token = this.repoToken;

    this.git.setCwd(repoPath);
    this.state.repoPath = repoPath;
    this.state.repoName = basename(repoPath);
    const idx = this.state.openRepos.findIndex(r => r.path === repoPath);
    if (idx !== -1) {
      this.state.activeRepoIndex = idx;
      this.state.openRepos = [...this.state.openRepos];
    }

    const inMemory = this.repoSnapshots.get(repoPath);
    if (inMemory) {
      this.applyRepoSnapshot(inMemory);
    } else {
      this.state.currentBranch = '';
      this.state.branches = [];
      this.state.tags = [];
      this.state.stashes = [];
      this.state.remotes = [];
      this.state.stagedFiles = [];
      this.state.unstagedFiles = [];
      this.state.conflicts = [];
      this.state.ahead = 0;
      this.state.behind = 0;
      this.state.commits = [];
      this.state.graphLayout = { nodes: [], maxColumns: 0, mergeLinks: [] };
      this.state.selectedCommitHash = null;
      // Новый репо — сбрасываем кэши хэшей, чтобы stdout-hash одного репо
      // не сравнивался с stdout другого.
      this.cachedHeadHash = null;
      this.cachedLogHash = null;
      this.cachedLogLimit = 0;
    }
    perfLog('switchRepo.notify#1(initial)');
    this.notify();

    // Notify FileWatcher в микротаске, ПОСЛЕ отправки IPC.
    // chokidar.close() большого worktree (тысячи зарегистрированных FD)
    // на Windows легко блокирует main thread на 500-1500мс. Если сделать
    // synchronous — IPC-сообщение с новым снапшотом уходит в renderer
    // только после перестройки watcher'ов → юзер видит "залипшую" историю.
    setImmediate(() => {
      if (token !== this.repoToken) return;
      const endSwitch = perfMark('fileWatcher.switchRepo');
      this.notifyRepoSwitch(repoPath);
      endSwitch();
    });

    let haveInstantData = false;
    if (!inMemory) {
      const endLoad = perfMark('switchRepo.loadGraphCache');
      const cache = await loadGraphCache(repoPath);
      endLoad();
      if (token !== this.repoToken) { endTotal(); return; }
      if (cache) {
        perfLog('switchRepo.cacheHit', { commits: cache.commits.length, nodes: cache.layout.nodes.length });
        this.state.commits = cache.commits;
        this.state.graphLayout = cache.layout;
        this.cachedHeadHash = cache.headHash;
        perfLog('switchRepo.notify#2(cache)');
        this.notify();
        haveInstantData = true;
      } else {
        perfLog('switchRepo.cacheMiss');
      }
    } else {
      perfLog('switchRepo.inMemorySnapshot', { commits: this.state.commits.length });
      this.cachedHeadHash = inMemory.headHash;
      haveInstantData = true;
    }

    // Если есть мгновенные данные (snapshot или disk cache) — refreshAll
    // запускаем в фоне, чтобы switchRepo вернулся сразу. Renderer уже
    // получил картинку в первых двух notify; свежие данные догонят позже.
    if (haveInstantData) {
      endTotal();
      queueMicrotask(() => {
        if (token !== this.repoToken) return;
        this.refreshAll().catch(err => {
          perfLog('refreshAll.background.error', { msg: err instanceof Error ? err.message : String(err) });
        });
      });
      return;
    }

    // Холодный старт — пользователю всё равно нечего показывать,
    // ждём первую фазу refreshAll синхронно.
    await this.refreshAll();
    endTotal();
  }

  private captureRepoSnapshot(): RepoSnapshot {
    return {
      currentBranch: this.state.currentBranch,
      branches: this.state.branches,
      tags: this.state.tags,
      stashes: this.state.stashes,
      remotes: this.state.remotes,
      stagedFiles: this.state.stagedFiles,
      unstagedFiles: this.state.unstagedFiles,
      conflicts: this.state.conflicts,
      ahead: this.state.ahead,
      behind: this.state.behind,
      commits: this.state.commits,
      graphLayout: this.state.graphLayout,
      selectedCommitHash: this.state.selectedCommitHash,
      headHash: this.cachedHeadHash,
      logHash: this.cachedLogHash,
      logLimit: this.cachedLogLimit,
    };
  }

  private applyRepoSnapshot(snapshot: RepoSnapshot): void {
    this.state.currentBranch = snapshot.currentBranch;
    this.state.branches = snapshot.branches;
    this.state.tags = snapshot.tags;
    this.state.stashes = snapshot.stashes;
    this.state.remotes = snapshot.remotes;
    this.state.stagedFiles = snapshot.stagedFiles;
    this.state.unstagedFiles = snapshot.unstagedFiles;
    this.state.conflicts = snapshot.conflicts;
    this.state.ahead = snapshot.ahead;
    this.state.behind = snapshot.behind;
    this.state.commits = snapshot.commits;
    this.state.graphLayout = snapshot.graphLayout;
    this.state.selectedCommitHash = snapshot.selectedCommitHash;
    this.cachedLogHash = snapshot.logHash;
    this.cachedLogLimit = snapshot.logLimit;
  }

  setRepoPath(repoPath: string): void {
    this.state.repoPath = repoPath;
    this.state.repoName = basename(repoPath);

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
    this.repoToken++;
    const empty = this.emptyState();
    this.state = empty;
    this.cachedHeadHash = null;
    this.cachedLogHash = null;
    this.cachedLogLimit = 0;
    this.notify();
  }

  setOperationRunning(running: boolean, operation: string | null): void {
    this.state.isOperationRunning = running;
    this.state.currentOperation = operation;
    this.notify();
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
    this.repoSnapshots.delete(closedPath);
    for (const listener of this.repoCloseListeners) {
      try {
        listener(closedPath);
      } catch {
        // listener error — don't crash state manager
      }
    }
  }

  invalidateGraphCache(): void {
    this.cachedHeadHash = null;
    this.cachedLogHash = null;
    this.cachedLogLimit = 0;
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

  private async refreshAheadBehind(): Promise<void> {
    const token = this.repoToken;
    try {
      const result = await this.git.exec([
        'rev-list', '--left-right', '--count', 'HEAD...@{upstream}',
      ]);
      if (token !== this.repoToken) return;
      const parts = result.stdout.trim().split('\t');
      this.state.ahead = parseInt(parts[0], 10) || 0;
      this.state.behind = parseInt(parts[1], 10) || 0;
    } catch {
      if (token !== this.repoToken) return;
      this.state.ahead = 0;
      this.state.behind = 0;
    }
  }

  private notify(): void {
    // Shallow-копия верхнего уровня достаточна: React-потребители сравнивают
    // ссылки на массивы; сами массивы мы всегда пересобираем в refresh*-методах
    // (через присваивание новых массивов), поэтому глубокое копирование 50k
    // коммитов здесь — лишняя нагрузка GC и источник тормозов при переключении.
    const snapshot: AppState = { ...this.state };

    // Актуализируем in-memory snapshot для текущего репо на каждый notify.
    // Без этого snapshot, сохранённый в момент openRepo (когда commits ещё
    // пустые), никогда не обновляется — и при возврате на репо юзер видит
    // пустой граф, пока refreshAll не догонит.
    if (this.state.repoPath) {
      this.repoSnapshots.set(this.state.repoPath, this.captureRepoSnapshot());
    }

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

/** Быстрый MD5-хэш для дедупликации `git log` stdout (до 30 MB). */
function hashString(s: string): string {
  return createHash('md5').update(s).digest('hex');
}
