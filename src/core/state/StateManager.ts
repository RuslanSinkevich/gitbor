import { basename } from 'path';
import { GitExecutor } from '../git/GitExecutor';
import * as GitParser from '../git/GitParser';
import { computeGraphLayout } from '../git/GraphLayout';
import {
  AppState,
  Branch,
  Commit,
  FileStatus,
  GraphLayoutData,
  RepoInfo,
  Remote,
  Stash,
  Tag,
} from '../git/types';

type StateListener = (state: AppState) => void;
type RepoSwitchListener = (newPath: string) => void;

const LOG_FORMAT =
  '%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s';
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

  private static readonly INITIAL_COMMIT_LIMIT = 0;

  async refreshAll(): Promise<void> {
    await Promise.all([
      this.refreshBranches(),
      this.refreshTags(),
      this.refreshStashes(),
      this.refreshRemotes(),
      this.refreshStatus(),
    ]);
    await this.refreshGraph(StateManager.INITIAL_COMMIT_LIMIT);
    this.notify();
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
    await this.refreshStatus();
    this.notify();
  }

  async refreshStatus(): Promise<void> {
    try {
      const statusResult = await this.git.exec([
        'status', '--porcelain=v1',
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

      if (headHash === this.cachedHeadHash && this.state.commits.length > 0) {
        return;
      }

      this.cachedHeadHash = headHash;

      const logArgs = ['log', '--all', '--date-order', `--format=${LOG_FORMAT}`];
      if (maxCount > 0) logArgs.push(`--max-count=${maxCount}`);

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
    this.git.setCwd(repoPath);
    this.state.repoPath = repoPath;
    this.state.repoName = basename(repoPath);
    const idx = this.state.openRepos.findIndex(r => r.path === repoPath);
    if (idx !== -1) {
      this.state.activeRepoIndex = idx;
      this.state.openRepos = [...this.state.openRepos];
    }
    this.cachedHeadHash = null;
    this.notifyRepoSwitch(repoPath);
    await this.refreshAll();
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
    const snapshot: AppState = {
      ...this.state,
      branches: [...this.state.branches],
      tags: [...this.state.tags],
      stashes: [...this.state.stashes],
      remotes: [...this.state.remotes],
      stagedFiles: [...this.state.stagedFiles],
      unstagedFiles: [...this.state.unstagedFiles],
      conflicts: [...this.state.conflicts],
      commits: [...this.state.commits],
      openRepos: [...this.state.openRepos],
      graphLayout: {
        ...this.state.graphLayout,
        nodes: [...this.state.graphLayout.nodes],
        mergeLinks: [...(this.state.graphLayout.mergeLinks ?? [])],
      },
    };
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
