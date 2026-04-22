import { basename } from 'path';
import { GitExecutor } from '../git/GitExecutor';
import * as GitParser from '../git/GitParser';
import { computeGraphLayout } from '../git/GraphLayout';
import { loadGraphCache, saveGraphCache } from './GraphCache';
import {
  AppState,
  Commit,
  RepoInfo,
} from '../git/types';

type StateListener = (state: AppState) => void;
type RepoSwitchListener = (newPath: string) => void;
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
  private readonly listeners = new Set<StateListener>();
  private readonly repoSwitchListeners = new Set<RepoSwitchListener>();
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
    await this.refreshFast();
    if (token !== this.repoToken) return;
    this.notify();
    await this.refreshGraphProgressive(token);
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
    await this.refreshGraph(StateManager.PROGRESSIVE_FIRST_LIMIT);
    if (token !== this.repoToken) return;
    this.notify();

    if (this.state.commits.length >= StateManager.PROGRESSIVE_FIRST_LIMIT) {
      await this.refreshGraph(StateManager.PROGRESSIVE_FULL_LIMIT);
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
    try {
      const localResult = await this.git.exec([
        'for-each-ref', '--format=' + REF_FORMAT, 'refs/heads/',
      ]);
      const localBranches = GitParser.parseBranches(localResult.stdout, false);

      const remoteResult = await this.git.exec([
        'for-each-ref', '--format=' + REF_FORMAT, 'refs/remotes/',
      ]);
      const remoteBranches = GitParser.parseBranches(remoteResult.stdout, true);

      this.state.branches = [...localBranches, ...remoteBranches];

      const headResult = await this.git.exec([
        'rev-parse', '--abbrev-ref', 'HEAD',
      ]);
      this.state.currentBranch = headResult.stdout.trim();

      await this.refreshAheadBehind();
    } catch {
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
    try {
      const statusResult = await this.git.exec([
        'status', '--porcelain=v1', '--untracked-files=all',
      ]);
      const allFiles = GitParser.parseStatus(statusResult.stdout);
      this.state.stagedFiles = allFiles.filter(f => f.staged);
      this.state.unstagedFiles = allFiles.filter(f => !f.staged);

      this.state.conflicts = allFiles
        .filter(f => f.status === 'U')
        .map(f => f.path);
    } catch {
      this.state.stagedFiles = [];
      this.state.unstagedFiles = [];
      this.state.conflicts = [];
    }
  }

  async refreshGraph(maxCount = 0): Promise<void> {
    try {
      const headResult = await this.git.exec(['rev-parse', 'HEAD']);
      const headHash = headResult.stdout.trim();

      const effectiveLimit = maxCount > 0 ? maxCount : StateManager.INITIAL_COMMIT_LIMIT;

      if (headHash === this.cachedHeadHash && this.state.commits.length > 0 && this.state.commits.length >= effectiveLimit) {
        return;
      }

      this.cachedHeadHash = headHash;

      const logArgs = ['log', '--all', '--date-order', `--format=${LOG_FORMAT}`];
      logArgs.push(`--max-count=${effectiveLimit}`);

      const logResult = await this.git.exec(logArgs);

      this.state.commits = GitParser.parseCommits(logResult.stdout);
      this.state.graphLayout = computeGraphLayout(
        this.state.commits as Commit[]
      );
    } catch {
      this.state.commits = [];
      this.state.graphLayout = { nodes: [], maxColumns: 0, mergeLinks: [] };
      this.cachedHeadHash = null;
    }
  }

  async refreshTags(): Promise<void> {
    try {
      const tagResult = await this.git.exec([
        'for-each-ref', '--sort=-creatordate', '--format=' + TAG_REF_FORMAT,
        'refs/tags/',
      ]);
      this.state.tags = GitParser.parseTags(tagResult.stdout);
    } catch {
      this.state.tags = [];
    }
  }

  async refreshStashes(): Promise<void> {
    try {
      const stashResult = await this.git.exec([
        'stash', 'list', '--format=' + STASH_FORMAT,
      ]);
      this.state.stashes = GitParser.parseStashes(stashResult.stdout);
    } catch {
      this.state.stashes = [];
    }
  }

  async refreshRemotes(): Promise<void> {
    try {
      const remoteResult = await this.git.exec(['remote', '-v']);
      this.state.remotes = GitParser.parseRemotes(remoteResult.stdout);
    } catch {
      this.state.remotes = [];
    }
  }

  async switchRepo(repoPath: string): Promise<void> {
    if (this.state.repoPath) {
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
    }
    this.notifyRepoSwitch(repoPath);
    this.notify();

    if (!inMemory) {
      this.cachedHeadHash = null;
      const cache = await loadGraphCache(repoPath);
      if (token !== this.repoToken) return;
      if (cache) {
        this.state.commits = cache.commits;
        this.state.graphLayout = cache.layout;
        this.cachedHeadHash = cache.headHash;
        this.notify();
      }
    } else {
      this.cachedHeadHash = inMemory.headHash;
    }

    await this.refreshAll();
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

  invalidateGraphCache(): void {
    this.cachedHeadHash = null;
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
    try {
      const result = await this.git.exec([
        'rev-list', '--left-right', '--count', 'HEAD...@{upstream}',
      ]);
      const parts = result.stdout.trim().split('\t');
      this.state.ahead = parseInt(parts[0], 10) || 0;
      this.state.behind = parseInt(parts[1], 10) || 0;
    } catch {
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
